/**
 * Keeps a view reachable by source events while a request is in flight, and
 * records that the note moved on underneath it.
 *
 * Without this, a view whose session is `loading` reports no source path, so
 * every editor-change, modify, rename and delete arriving during an Open or a
 * Refresh is dropped. The request would then finish and label a body `fresh`
 * that the note had already left behind.
 */
export class SourceChangeWatch {
	private generation = 0;
	private pending: { requestId: number; sourcePath: string } | null = null;

	/**
	 * Binds the path a request is working on and returns the change token to
	 * compare against once it finishes. A null path means the request has no
	 * note to watch, which also drops any binding it superseded.
	 */
	beginRequest(requestId: number, sourcePath: string | null): number {
		this.pending =
			sourcePath === null ? null : { requestId, sourcePath };
		return this.generation;
	}

	/** Clears the binding, but only for the request that owns it. */
	endRequest(requestId: number): void {
		if (this.pending?.requestId === requestId) {
			this.pending = null;
		}
	}

	/** The in-flight path, while its request is still the current one. */
	pendingSourcePath(isCurrent: (requestId: number) => boolean): string | null {
		if (!this.pending || !isCurrent(this.pending.requestId)) {
			return null;
		}
		return this.pending.sourcePath;
	}

	/** A source event arrived; anything in flight is now suspect. */
	notifyChanged(): void {
		this.generation += 1;
	}

	/**
	 * True when the note changed after `token` was taken. A request that ends
	 * on `true` must not claim `fresh`: it may have read the body before the
	 * change landed, and re-reading here would only start another race.
	 */
	changedSince(token: number): boolean {
		return this.generation !== token;
	}

	/** Drops the binding and invalidates outstanding tokens. */
	reset(): void {
		this.generation += 1;
		this.pending = null;
	}
}
