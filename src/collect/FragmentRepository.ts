import type { CollectedFragment } from "./CollectedFragment";
import { collectProtectedPaths } from "./collectProvenance";
import { appendCollectionEntry, createCollectionDocument } from "./collectionDocument";
import type { CollectionStorage } from "./CollectionStorage";
import { isCollectionPath } from "../settings/collectionPath";
import { serializeFragmentEntry } from "./serializeFragmentEntry";

/** Why the configured path cannot be written to. */
export type CollectionPathConflict =
	| "folder"
	| "non-markdown"
	| "parent-missing"
	| "source-note";

/**
 * Outcome of one append, as a status rather than a thrown message.
 *
 * Nothing here carries the fragment, the source path, or an exception's text,
 * so a caller can act on the result — or show it — without leaking anything
 * the user wrote or where they wrote it.
 */
export type AppendFragmentResult =
	| { status: "created" }
	| { status: "appended" }
	| { status: "conflict"; reason: CollectionPathConflict }
	| { status: "invalid-path" }
	| { status: "failed" };

/**
 * The whole of Collect's write surface: one entry, into the configured
 * collection. There is deliberately no method that takes a destination.
 */
export interface FragmentRepository {
	append(fragment: CollectedFragment): Promise<AppendFragmentResult>;
}

/** Read when an append runs, so a changed setting takes effect immediately. */
export type CollectionPathSource = () => string;

export class MarkdownFragmentRepository implements FragmentRepository {
	private queue: Promise<unknown> = Promise.resolve();

	constructor(
		private readonly storage: CollectionStorage,
		private readonly collectionPath: CollectionPathSource,
	) {}

	/**
	 * Adds one entry to the configured collection.
	 *
	 * Appends run one at a time, in the order they were requested. Several
	 * explicit Collects started together therefore all survive, each exactly
	 * once, in the order the user asked for them — none of them reads a copy of
	 * the file that another one is about to replace.
	 */
	append(fragment: CollectedFragment): Promise<AppendFragmentResult> {
		const entry = serializeFragmentEntry(fragment);
		return this.enqueue(async () => {
			const path = this.collectionPath();
			if (!isCollectionPath(path)) {
				return { status: "invalid-path" };
			}
			const protectedPaths = collectProtectedPaths(fragment.metadata);
			if (protectedPaths.includes(path)) {
				// The collection would be the Target or a Vocabulary Source.
				// Refuse before any inspect, create or process so Collect cannot
				// rewrite the notes that produced this result.
				return { status: "conflict", reason: "source-note" };
			}
			try {
				return await this.write(path, entry);
			} catch {
				// The write may or may not have landed. The one thing this must not
				// do is try again: a second attempt would risk storing the same
				// entry twice, and a duplicate the user did not choose is worse
				// than a Collect they can repeat themselves.
				return { status: "failed" };
			}
		});
	}

	private async write(
		path: string,
		entry: string,
	): Promise<AppendFragmentResult> {
		const state = await this.storage.inspect(path);
		if (state.status === "folder" || state.status === "non-markdown") {
			return { status: "conflict", reason: state.status };
		}
		if (state.status === "markdown") {
			return await this.appendToExisting(path, entry);
		}

		const created = await this.storage.create(
			path,
			createCollectionDocument(entry),
		);
		if (created.status === "created") {
			return { status: "created" };
		}
		if (created.status === "parent-missing") {
			return { status: "conflict", reason: "parent-missing" };
		}
		if (created.status !== "already-exists") {
			return { status: "failed" };
		}

		// Something else created the path between the check and the create. Look
		// again rather than assume it is the collection: it may be a folder now.
		const recheck = await this.storage.inspect(path);
		if (recheck.status === "markdown") {
			return await this.appendToExisting(path, entry);
		}
		if (recheck.status === "folder" || recheck.status === "non-markdown") {
			return { status: "conflict", reason: recheck.status };
		}
		return { status: "failed" };
	}

	private async appendToExisting(
		path: string,
		entry: string,
	): Promise<AppendFragmentResult> {
		const processed = await this.storage.process(path, (contents) =>
			appendCollectionEntry(contents, entry),
		);
		if (processed.status === "processed") {
			return { status: "appended" };
		}
		if (processed.status === "not-a-file") {
			return { status: "conflict", reason: "non-markdown" };
		}
		// Missing means the file went away mid-append. Report the failure rather
		// than starting the create path over, which could loop against whatever
		// keeps removing it.
		return { status: "failed" };
	}

	/** Runs appends one at a time, in request order, whatever their outcome. */
	private enqueue<T>(task: () => Promise<T>): Promise<T> {
		const result = this.queue.then(task, task);
		this.queue = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}
}
