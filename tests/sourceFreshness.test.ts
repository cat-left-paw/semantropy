import { describe, expect, it, vi } from "vitest";
import { SemantropySession } from "../src/application/SemantropySession";
import { createSourceSnapshot } from "../src/application/SourceSnapshot";
import {
	STALE_SOURCE_MESSAGE,
	checkSourceFreshness,
} from "../src/application/sourceFreshness";
import { MAX, emptyReadyAnalysis } from "./readyAnalysis";
import { SEMANTROPY_ALGORITHM_VERSION } from "../src/random/seededRandom";

function deferred<T>(): {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (error: unknown) => void;
} {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function snapshot(text: string, contentHash: string, path = "note.md") {
	return createSourceSnapshot({
		sourcePath: path,
		sourceName: path,
		text,
		contentHash,
	});
}

function readySession(
	text = "original body",
	contentHash = "hash-original",
	path = "note.md",
): SemantropySession {
	const session = new SemantropySession();
	session.completeReady(
		session.beginLoading(),
		snapshot(text, contentHash, path),
		7,
		emptyReadyAnalysis({ replacementCount: 3 }),
	);
	return session;
}

type CheckOverrides = {
	readCurrentText?: (sourcePath: string) => Promise<string>;
	hashText?: (text: string) => Promise<string>;
	isAbandoned?: () => boolean;
	generation?: number;
};

function runCheck(session: SemantropySession, overrides: CheckOverrides = {}) {
	const generation = overrides.generation ?? session.beginFreshnessCheck();
	return checkSourceFreshness({
		generation,
		isCurrentGeneration: (id) => session.isCurrentFreshnessCheck(id),
		getReadySnapshot: () => session.getReadySnapshot(),
		readCurrentText: overrides.readCurrentText ?? (async () => "original body"),
		hashText: overrides.hashText ?? (async (text) => `hash-${text}`),
		isAbandoned: overrides.isAbandoned ?? (() => false),
		setFreshness: (target, freshness) =>
			session.setSourceFreshness(target, freshness),
	});
}

function readyFreshness(session: SemantropySession): string | null {
	const state = session.getState();
	return state.status === "ready" ? state.freshness : null;
}

describe("checkSourceFreshness", () => {
	it("marks the view stale when the current body hashes differently", async () => {
		const session = readySession();
		const result = await runCheck(session, {
			readCurrentText: async () => "edited body",
		});

		expect(result).toEqual({ status: "applied", freshness: "stale" });
		expect(readyFreshness(session)).toBe("stale");
	});

	it("keeps the view fresh when the hash still matches", async () => {
		const session = readySession("original body", "hash-original body");
		const result = await runCheck(session);

		expect(result).toEqual({ status: "applied", freshness: "fresh" });
		expect(readyFreshness(session)).toBe("fresh");
	});

	it("returns to fresh when an edit is undone back to the snapshot body", async () => {
		const session = readySession("original body", "hash-original body");
		await runCheck(session, { readCurrentText: async () => "edited body" });
		expect(readyFreshness(session)).toBe("stale");

		const restored = await runCheck(session, {
			readCurrentText: async () => "original body",
		});
		expect(restored).toEqual({ status: "applied", freshness: "fresh" });
		expect(readyFreshness(session)).toBe("fresh");
	});

	it("stays fresh when only the file mtime moved and the body did not", async () => {
		const session = readySession("original body", "hash-original body");
		const hashText = vi.fn(async (text: string) => `hash-${text}`);
		// A save with no edits: the modify event fires, the bytes are identical.
		await runCheck(session, {
			readCurrentText: async () => "original body",
			hashText,
		});

		expect(readyFreshness(session)).toBe("fresh");
		expect(hashText).toHaveBeenCalledWith("original body");
	});

	it("does not touch the snapshot, Seed, analysis or replacement count", async () => {
		const session = readySession();
		const before = session.getState();
		await runCheck(session, { readCurrentText: async () => "edited body" });
		const after = session.getState();

		expect(before.status).toBe("ready");
		expect(after.status).toBe("ready");
		if (before.status !== "ready" || after.status !== "ready") {
			return;
		}
		expect(after.snapshot).toBe(before.snapshot);
		expect(after.snapshot.text).toBe("original body");
		expect(after.snapshot.contentHash).toBe("hash-original");
		expect(after.bodySeed).toBe(before.bodySeed);
		expect(after.tokenSequences).toBe(before.tokenSequences);
		expect(after.pool).toBe(before.pool);
		expect(after.replacementCount).toBe(before.replacementCount);
		expect(after.algorithmVersion).toBe(before.algorithmVersion);
	});

	it("never tokenizes or re-renders while checking", async () => {
		const session = readySession();
		const tokenize = vi.fn();
		await runCheck(session, {
			readCurrentText: async () => {
				tokenize();
				return "edited body";
			},
			hashText: async (text) => `hash-${text}`,
		});

		// The only work is one read plus one hash; nothing analyses the body.
		expect(tokenize).toHaveBeenCalledTimes(1);
		expect(readyFreshness(session)).toBe("stale");
	});

	it("treats an unreadable source as stale rather than fresh", async () => {
		const session = readySession();
		const result = await runCheck(session, {
			readCurrentText: async () => {
				throw new Error("The source note is no longer available.");
			},
		});

		expect(result).toEqual({ status: "applied", freshness: "stale" });
		expect(readyFreshness(session)).toBe("stale");
	});

	it("treats a hash failure as stale rather than fresh", async () => {
		const session = readySession();
		const result = await runCheck(session, {
			hashText: async () => {
				throw new Error("digest unavailable");
			},
		});

		expect(result).toEqual({ status: "applied", freshness: "stale" });
		expect(readyFreshness(session)).toBe("stale");
	});

	it("applies only the newest verdict when checks finish out of order", async () => {
		const session = readySession("original body", "hash-original body");
		const first = deferred<string>();
		const second = deferred<string>();

		const firstCheck = runCheck(session, {
			readCurrentText: () => first.promise,
		});
		const secondCheck = runCheck(session, {
			readCurrentText: () => second.promise,
		});

		// B started last but finishes first, then the older A resolves.
		second.resolve("edited body");
		expect(await secondCheck).toEqual({ status: "applied", freshness: "stale" });
		first.resolve("original body");
		expect(await firstCheck).toEqual({
			status: "ignored",
			reason: "superseded",
		});

		expect(readyFreshness(session)).toBe("stale");
	});

	it("does not apply a check that started before a refresh completed", async () => {
		const session = readySession("original body", "hash-original body");
		const pending = deferred<string>();
		const check = runCheck(session, { readCurrentText: () => pending.promise });

		// A refresh replaces the whole ready session while the check is in flight.
		const refreshId = session.beginLoading();
		session.completeReady(
			refreshId,
			snapshot("refreshed body", "hash-refreshed body"),
			9,
			emptyReadyAnalysis({ replacementCount: 5 }),
		);

		pending.resolve("original body");
		expect(await check).toEqual({ status: "ignored", reason: "superseded" });
		expect(readyFreshness(session)).toBe("fresh");
	});

	it("does not apply a check after the view closed", async () => {
		const session = readySession();
		const pending = deferred<string>();
		let closed = false;
		const check = runCheck(session, {
			readCurrentText: () => pending.promise,
			isAbandoned: () => closed,
		});

		closed = true;
		session.dispose();
		pending.resolve("edited body");

		expect(await check).toEqual({ status: "ignored", reason: "abandoned" });
		expect(session.getState()).toEqual({ status: "empty" });
	});

	it("ignores a check when nothing is ready", async () => {
		const session = new SemantropySession();
		expect(await runCheck(session)).toEqual({
			status: "ignored",
			reason: "not-ready",
		});
	});

	it("states the stale condition in words, without the note body", () => {
		expect(STALE_SOURCE_MESSAGE).toBe(
			"Source changed. This view is based on an older snapshot. Use Refresh target.",
		);
		expect(STALE_SOURCE_MESSAGE).not.toContain("original body");
	});
});

describe("SemantropySession freshness", () => {
	it("starts fresh and rejects a verdict for a replaced snapshot", () => {
		const session = readySession();
		expect(readyFreshness(session)).toBe("fresh");

		const orphan = snapshot("other", "hash-other");
		expect(session.setSourceFreshness(orphan, "stale")).toBe(false);
		expect(readyFreshness(session)).toBe("fresh");
	});

	it("marks a renamed or deleted source stale without adopting another path", () => {
		const session = readySession();
		const before = session.getReadySnapshot();
		expect(session.markSourceStale()).toBe(true);
		expect(readyFreshness(session)).toBe("stale");
		expect(session.getReadySnapshot()).toBe(before);
		expect(session.getReadySnapshot()?.sourcePath).toBe("note.md");
	});

	it("stops an in-flight check from undoing a rename or delete", async () => {
		const session = readySession("original body", "hash-original body");
		const pending = deferred<string>();
		const check = runCheck(session, { readCurrentText: () => pending.promise });

		session.markSourceStale();
		pending.resolve("original body");

		expect(await check).toEqual({ status: "ignored", reason: "superseded" });
		expect(readyFreshness(session)).toBe("stale");
	});

	it("keeps freshness across a reshuffle transform update", () => {
		const session = readySession();
		session.markSourceStale();
		expect(
			session.updateReadyTransform({
				bodySeed: 11,
				replacementCount: 3,
				replaceableSlotCount: 3,
				bodySemantropy: MAX,
				algorithmVersion: SEMANTROPY_ALGORITHM_VERSION,
			}),
		).toBe(true);
		expect(readyFreshness(session)).toBe("stale");
	});
});
