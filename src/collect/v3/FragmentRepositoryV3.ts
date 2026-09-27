import type { CollectionStorage } from "../CollectionStorage";
import type { AppendFragmentResult, CollectionPathSource } from "../FragmentRepository";
import { collectProtectedPaths } from "../collectProvenance";
import { appendCollectionEntry, createCollectionDocument } from "../collectionDocument";
import { isCollectionPath } from "../../settings/collectionPath";
import { buildCollectedFragmentV3, captureFragmentIdentityV3, type CollectedFragmentV3, type CollectFragmentInputV3 } from "./CollectedFragmentV3";
import { exactCollectFields, ownCollectData } from "./collectDataV3";
import { serializeFragmentEntryV3 } from "./serializeFragmentV3";

export interface FragmentRepositoryV3 {
	append(fragment: CollectedFragmentV3): Promise<AppendFragmentResult>;
}

/** Current production entry point. Existing Collection bytes remain untouched.
 * The injected storage owns atomic process; the queue orders this repository's requests.
 */
export class MarkdownFragmentRepositoryV3 implements FragmentRepositoryV3 {
	#queue: Promise<unknown> = Promise.resolve();
	constructor(private readonly storage: CollectionStorage, private readonly collectionPath: CollectionPathSource) {}
	append(fragment: CollectedFragmentV3): Promise<AppendFragmentResult> {
		// Capture before enqueue, so entry bytes and protected paths refer to the same value.
		let entry: string, protectedPaths: readonly string[];
		try {
			const root = ownCollectData(fragment); exactCollectFields(root, ["text", "metadata"]);
			const data = ownCollectData(root.metadata);
			const { id, created, ...input } = data;
			const identity = captureFragmentIdentityV3({ id, created });
			const captured = buildCollectedFragmentV3({ ...input, text: root.text } as CollectFragmentInputV3, identity);
			entry = serializeFragmentEntryV3(captured);
			protectedPaths = collectProtectedPaths(captured.metadata);
		} catch { return Promise.resolve({ status: "failed" }); }
		const task = async (): Promise<AppendFragmentResult> => {
			try {
				const path = this.collectionPath();
				if (!isCollectionPath(path)) return { status: "invalid-path" };
				if (protectedPaths.includes(path)) return { status: "conflict", reason: "source-note" };
				return await this.write(path, entry);
			} catch { return { status: "failed" }; } // Effect unknown: never retry.
		};
		const result = this.#queue.then(task, task);
		this.#queue = result.then(() => undefined, () => undefined);
		return result;
	}
	private async write(path: string, entry: string): Promise<AppendFragmentResult> {
		const state = await this.storage.inspect(path);
		if (state.status === "folder" || state.status === "non-markdown") return { status: "conflict", reason: state.status };
		if (state.status === "markdown") return this.appendToExisting(path, entry);
		const created = await this.storage.create(path, createCollectionDocument(entry));
		if (created.status === "created") return { status: "created" };
		if (created.status === "parent-missing") return { status: "conflict", reason: "parent-missing" };
		if (created.status !== "already-exists") return { status: "failed" };
		// Only a confirmed pre-write create race permits reinspection, never an unknown failure.
		const recheck = await this.storage.inspect(path);
		if (recheck.status === "markdown") return this.appendToExisting(path, entry);
		if (recheck.status === "folder" || recheck.status === "non-markdown") return { status: "conflict", reason: recheck.status };
		return { status: "failed" };
	}
	private async appendToExisting(path: string, entry: string): Promise<AppendFragmentResult> {
		const result = await this.storage.process(path, contents => appendCollectionEntry(contents, entry));
		if (result.status === "processed") return { status: "appended" };
		if (result.status === "not-a-file") return { status: "conflict", reason: "non-markdown" };
		return { status: "failed" };
	}
}
