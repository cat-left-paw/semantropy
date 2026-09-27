import { describe, expect, it } from "vitest";
import {
	OPEN_SNAPSHOT_ERROR_MESSAGE,
	captureSourceSnapshot,
	SemantropySession,
} from "../src/application/SemantropySession";
import { createSourceSnapshot } from "../src/application/SourceSnapshot";
import type { SourceCapture } from "../src/application/selectSourceText";
import { SEMANTROPY_ALGORITHM_VERSION } from "../src/random/seededRandom";
import { token } from "./tokenFixtures";
import { MAX, emptyReadyAnalysis } from "./readyAnalysis";
import { DEFAULT_BODY_SEMANTROPY } from "../src/settings/bodySemantropy";

const noteCapture = (text: string | null, path = "note.md"): SourceCapture => ({
	kind: "markdown",
	note: {
		sourcePath: path,
		sourceName: "note.md",
		editorText: text,
	},
});

function snapshot(text: string, hash = "hash") {
	return createSourceSnapshot({
		sourcePath: "note.md",
		sourceName: "note.md",
		text,
		contentHash: hash,
	});
}

describe("SemantropySession", () => {
	it("holds seed 0 and analysis on a ready session", () => {
		const session = new SemantropySession();
		const requestId = session.beginLoading();
		const cat = token({ surface: "猫" });
		const analysis = emptyReadyAnalysis({
			tokenSequences: [[cat]],
			replacementCount: 1,
		});
		session.completeReady(requestId, snapshot("body"), 0, analysis);
		const state = session.getState();
		expect(state).toEqual({
			status: "ready",
			snapshot: snapshot("body"),
			bodySeed: 0,
			tokenSequences: [[cat]],
			pool: analysis.pool,
			replacementCount: 1,
			replaceableSlotCount: 0,
			bodySemantropy: DEFAULT_BODY_SEMANTROPY,
			algorithmVersion: SEMANTROPY_ALGORITHM_VERSION,
			freshness: "fresh",
		});
	});

	it("stays loading after a snapshot is captured", async () => {
		const session = new SemantropySession();
		const requestId = session.beginLoading();
		const captured = await captureSourceSnapshot(
			session,
			requestId,
			noteCapture("body"),
			{
				readCached: async () => "unused",
				hashText: async () => "hash",
				issueSeed: () => 7,
			},
		);
		expect(captured).toEqual({
			snapshot: snapshot("body"),
			bodySeed: 7,
		});
		expect(session.getState()).toEqual({
			status: "loading",
			requestId,
		});
	});

	it("clears a previous snapshot when entering empty", () => {
		const session = new SemantropySession();
		const first = session.beginLoading();
		session.completeReady(first, snapshot("previous body"), 1, emptyReadyAnalysis());
		const second = session.beginLoading();
		session.completeEmpty(second);
		expect(session.getState()).toEqual({ status: "empty" });
	});

	it("clears a previous snapshot when entering error", () => {
		const session = new SemantropySession();
		const first = session.beginLoading();
		session.completeReady(first, snapshot("previous body"), 1, emptyReadyAnalysis());
		const second = session.beginLoading();
		session.completeError(second, OPEN_SNAPSHOT_ERROR_MESSAGE);
		expect(session.getState()).toEqual({
			status: "error",
			message: OPEN_SNAPSHOT_ERROR_MESSAGE,
		});
		expect(JSON.stringify(session.getState())).not.toContain("previous body");
	});

	it("does not keep Obsidian objects in session state", () => {
		const session = new SemantropySession();
		const requestId = session.beginLoading();
		session.completeReady(requestId, snapshot("body"), 3, emptyReadyAnalysis());
		const encoded = JSON.stringify(session.getState());
		expect(encoded).not.toMatch(/TFile|MarkdownView|Vault|Editor|HTMLElement|Text/);
		expect(session.getState()).not.toHaveProperty("file");
		expect(session.getState()).not.toHaveProperty("vault");
	});

	it("does not include source text in error messages", async () => {
		const session = new SemantropySession();
		const requestId = session.beginLoading();
		await captureSourceSnapshot(session, requestId, noteCapture("secret body"), {
			readCached: async () => "unused",
			hashText: async () => {
				throw new Error("secret body leaked?");
			},
			issueSeed: () => 1,
		});
		const state = session.getState();
		expect(state.status).toBe("error");
		if (state.status === "error") {
			expect(state.message).toBe(OPEN_SNAPSHOT_ERROR_MESSAGE);
			expect(state.message).not.toContain("secret body");
		}
	});

	it("ignores an older async snapshot after a newer request finishes", async () => {
		const session = new SemantropySession();
		let finishFirstHash: ((hash: string) => void) | undefined;
		const firstHash = new Promise<string>((resolve) => {
			finishFirstHash = resolve;
		});

		const firstId = session.beginLoading();
		const firstCapture = captureSourceSnapshot(
			session,
			firstId,
			noteCapture("first body"),
			{
				readCached: async () => "unused",
				hashText: () => firstHash,
				issueSeed: () => 1,
			},
		);

		const secondId = session.beginLoading();
		const secondCaptured = await captureSourceSnapshot(
			session,
			secondId,
			noteCapture("second body"),
			{
				readCached: async () => "unused",
				hashText: async () => "hash-two",
				issueSeed: () => 2,
			},
		);
		if (!secondCaptured) {
			throw new Error("expected captured snapshot");
		}
		session.completeReady(
			secondId,
			secondCaptured.snapshot,
			secondCaptured.bodySeed,
			emptyReadyAnalysis({ replacementCount: 4 }),
		);

		finishFirstHash?.("hash-one");
		expect(await firstCapture).toBeNull();

		const state = session.getState();
		expect(state.status).toBe("ready");
		if (state.status === "ready") {
			expect(state.snapshot.text).toBe("second body");
			expect(state.snapshot.contentHash).toBe("hash-two");
			expect(state.bodySeed).toBe(2);
			expect(state.replacementCount).toBe(4);
		}
	});

	it("ignores a stale completeReady after a newer open", () => {
		const session = new SemantropySession();
		const firstId = session.beginLoading();
		const secondId = session.beginLoading();
		session.completeReady(
			secondId,
			snapshot("second body", "hash-two"),
			2,
			emptyReadyAnalysis({ replacementCount: 2 }),
		);
		session.completeReady(
			firstId,
			snapshot("first body", "hash-one"),
			1,
			emptyReadyAnalysis({ replacementCount: 9 }),
		);
		const state = session.getState();
		expect(state.status).toBe("ready");
		if (state.status === "ready") {
			expect(state.snapshot.text).toBe("second body");
			expect(state.bodySeed).toBe(2);
			expect(state.replacementCount).toBe(2);
		}
	});

	it("drops body references on dispose", () => {
		const session = new SemantropySession();
		const requestId = session.beginLoading();
		session.completeReady(requestId, snapshot("dispose me"), 4, emptyReadyAnalysis());
		session.dispose();
		expect(session.getState()).toEqual({ status: "empty" });
	});

	it("updates seed and replacement count without replacing snapshot or analysis", () => {
		const session = new SemantropySession();
		const requestId = session.beginLoading();
		const cat = token({ surface: "猫" });
		const analysis = emptyReadyAnalysis({
			tokenSequences: [[cat]],
			replacementCount: 2,
		});
		session.completeReady(requestId, snapshot("body", "hash-keep"), 1, analysis);
		const before = session.getState();
		expect(session.updateReadyTransform({
			bodySeed: 9,
			replacementCount: 4,
			replaceableSlotCount: 5,
			bodySemantropy: MAX,
			algorithmVersion: SEMANTROPY_ALGORITHM_VERSION,
		})).toBe(true);
		const state = session.getState();
		expect(state.status).toBe("ready");
		if (state.status !== "ready" || before.status !== "ready") {
			return;
		}
		expect(state.bodySeed).toBe(9);
		expect(state.replacementCount).toBe(4);
		expect(state.snapshot).toBe(before.snapshot);
		expect(state.snapshot.contentHash).toBe("hash-keep");
		expect(state.tokenSequences).toBe(before.tokenSequences);
		expect(state.pool).toBe(before.pool);
	});

	it("does not update transform fields when the session is not ready", () => {
		const session = new SemantropySession();
		expect(
			session.updateReadyTransform({
				bodySeed: 2,
				replacementCount: 1,
				replaceableSlotCount: 1,
				bodySemantropy: MAX,
				algorithmVersion: SEMANTROPY_ALGORITHM_VERSION,
			}),
		).toBe(false);
		expect(session.getState()).toEqual({ status: "empty" });
	});
});
