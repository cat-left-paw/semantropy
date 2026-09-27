/**
 * Counts source changes per Vault path, for the window a view cannot cover
 * itself.
 *
 * `Semantropy: Open` captures the editor body synchronously, then awaits the
 * leaf before the view can start watching the note. A change landing in that
 * gap reaches no view — on a first open the view does not exist yet — so the
 * plugin records the revision at capture time and the view compares it once
 * the snapshot is complete.
 *
 * Paths are plain strings; no Obsidian object is stored.
 */
export class SourceRevisionLog {
	private readonly revisions = new Map<string, number>();

	/** The revision to compare against later. Unseen paths start at 0. */
	current(sourcePath: string): number {
		return this.revisions.get(sourcePath) ?? 0;
	}

	/** Records that this path changed, was renamed away, or was deleted. */
	bump(sourcePath: string): void {
		this.revisions.set(sourcePath, this.current(sourcePath) + 1);
	}

	/** True when the path moved on since `token` was taken. */
	changedSince(sourcePath: string, token: number): boolean {
		return this.current(sourcePath) !== token;
	}
}
