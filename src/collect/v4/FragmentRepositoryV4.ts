import type { CollectionStorage } from "../CollectionStorage";
import type { AppendFragmentResult, CollectionPathSource } from "../FragmentRepository";
import { collectProtectedPaths } from "../collectProvenance";
import { appendCollectionEntry, createCollectionDocument } from "../collectionDocument";
import { isCollectionPath } from "../../settings/collectionPath";
import { buildCollectedFragmentV4, type CollectedFragmentV4, type CollectFragmentInputV4 } from "./CollectedFragmentV4";
import { captureFragmentIdentityV3 } from "../v3/CollectedFragmentV3";
import { exactCollectFieldsV4, ownCollectDataV4 } from "./collectDataV4";
import { serializeFragmentEntryV4 } from "./serializeFragmentV4";
import { collectAttributionSnapshot, type CollectAttributionSnapshot } from "./collectAttribution";

export interface FragmentRepositoryV4 {
	append(fragment: CollectedFragmentV4): Promise<AppendFragmentResult>;
}

/**
 * PRE-RELEASE-FAKE-PROVERB-COLLECT1 repository. Production-disconnected.
 *
 * The same write discipline as the v3 repository: the entry bytes and protected
 * paths are captured together before the request is queued; requests run in
 * order and a failure never stops the next one; a destination that is the
 * Target (for types that have one) or any Vocabulary Source is refused as a
 * `source-note` conflict before any storage call; only a confirmed create race
 * is re-inspected; an unknown effect is never retried. Existing Collection
 * bytes — v2 / v3 entries and unknown comments included — are only appended to.
 */
export class MarkdownFragmentRepositoryV4 implements FragmentRepositoryV4 {
	#queue: Promise<unknown> = Promise.resolve();
	constructor(
		private readonly storage: CollectionStorage,
		private readonly collectionPath: CollectionPathSource,
		private readonly attribution: (created: string) => CollectAttributionSnapshot = () => collectAttributionSnapshot(),
	) {}
	append(fragment: CollectedFragmentV4): Promise<AppendFragmentResult> {
		// Capture before enqueue, so entry bytes and protected paths refer to the same value.
		let entry: string, protectedPaths: readonly string[];
		try {
			const root = ownCollectDataV4(fragment);
			exactCollectFieldsV4(root, ["text", "metadata"]);
			const data = ownCollectDataV4(root["metadata"]);
			const { id, created, ...input } = data;
			const identity = captureFragmentIdentityV3({ id, created });
			// Rebuilt from the root text: for fake-proverb this re-checks text against canonicalText.
			const captured = buildCollectedFragmentV4({ ...input, text: root["text"] } as CollectFragmentInputV4, identity);
			const snapshot = collectAttributionSnapshot(this.attribution(captured.metadata.created));
			entry = serializeFragmentEntryV4(captured, snapshot);
			protectedPaths = collectProtectedPaths(captured.metadata);
		} catch {
			return Promise.resolve({ status: "failed" });
		}
		const task = async (): Promise<AppendFragmentResult> => {
			try {
				const path = this.collectionPath();
				if (!isCollectionPath(path)) return { status: "invalid-path" };
				if (protectedPaths.includes(path)) return { status: "conflict", reason: "source-note" };
				return await this.write(path, entry);
			} catch {
				return { status: "failed" }; // Effect unknown: never retry.
			}
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
		const result = await this.storage.process(path, (contents) => appendCollectionEntry(contents, entry));
		if (result.status === "processed") return { status: "appended" };
		if (result.status === "not-a-file") return { status: "conflict", reason: "non-markdown" };
		return { status: "failed" };
	}
}
