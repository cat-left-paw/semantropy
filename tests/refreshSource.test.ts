// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { REFRESH_ERROR_MESSAGE } from "../src/application/refreshSource";
import { dispatchSourceEvent } from "../src/application/dispatchSourceEvent";
import { invokeSemantropyViewCommand } from "../src/application/selectSemantropyView";
import { SemantropySession } from "../src/application/SemantropySession";
import { RefreshHarness, deferred } from "./refreshHarness";

async function openedHarness(
	body = "猫犬",
	sourcePath = "folder/note.md",
): Promise<RefreshHarness> {
	const harness = new RefreshHarness();
	harness.sources.set(sourcePath, body);
	await harness.open(sourcePath, "note.md");
	return harness;
}

describe("Refresh source identity", () => {
	it("re-reads the ready snapshot's path, not whatever note is active now", async () => {
		const harness = await openedHarness("猫犬", "folder/note.md");
		// The user has since moved to another note; it must be ignored.
		harness.sources.set("elsewhere.md", "別本文");
		harness.sources.set("folder/note.md", "猫犬鳥");
		harness.readCalls = [];

		expect(await harness.refreshSource()).toBe("refreshed");

		expect(harness.readCalls).toEqual(["folder/note.md"]);
		expect(harness.readyState()?.snapshot.sourcePath).toBe("folder/note.md");
		expect(harness.readyState()?.snapshot.sourceName).toBe("note.md");
		expect(harness.readyState()?.snapshot.text).toBe("猫犬鳥");
	});

	it("reports unavailable and reads nothing when no source is ready", async () => {
		const harness = new RefreshHarness();
		expect(await harness.refreshSource()).toBe("unavailable");
		expect(harness.readCalls).toEqual([]);
		expect(harness.session.getState()).toEqual({ status: "empty" });
	});
});

describe("Refresh source reading", () => {
	it("prefers an open editor buffer over the saved body", async () => {
		const harness = await openedHarness("猫犬");
		harness.sources.set("folder/note.md", "保存本文");
		harness.editors.set("folder/note.md", "未保存本文");
		harness.savedReadCalls = [];

		expect(await harness.refreshSource()).toBe("refreshed");
		expect(harness.readyState()?.snapshot.text).toBe("未保存本文");
		expect(harness.savedReadCalls).toEqual([]);
	});

	it("uses an editor buffer from any leaf, not only the focused one", async () => {
		const harness = await openedHarness("猫犬");
		harness.sources.set("folder/note.md", "保存本文");
		// The note sits in a background leaf while the Semantropy view is active.
		harness.editors.set("folder/note.md", "背景の未保存本文");

		expect(await harness.refreshSource()).toBe("refreshed");
		expect(harness.readyState()?.snapshot.text).toBe("背景の未保存本文");
	});

	it("rebuilds from an empty editor buffer instead of the saved body", async () => {
		const harness = await openedHarness("猫犬");
		harness.sources.set("folder/note.md", "保存本文");
		harness.editors.set("folder/note.md", "");
		harness.savedReadCalls = [];

		expect(await harness.refreshSource()).toBe("refreshed");
		expect(harness.readyState()?.snapshot.text).toBe("");
		expect(harness.readyState()?.snapshot.contentHash).toBe("hash()");
		expect(harness.savedReadCalls).toEqual([]);
	});

	it("reads the saved body only when no editor holds the note", async () => {
		const harness = await openedHarness("猫犬");
		harness.sources.set("folder/note.md", "保存本文");
		harness.savedReadCalls = [];

		expect(await harness.refreshSource()).toBe("refreshed");
		expect(harness.readyState()?.snapshot.text).toBe("保存本文");
		expect(harness.savedReadCalls).toEqual(["folder/note.md"]);
	});
});

describe("Refresh source rebuild", () => {
	it("replaces snapshot, hash, Seed, analysis, counts and body", async () => {
		const harness = await openedHarness("猫犬");
		const before = harness.readyState();
		if (!before) {
			throw new Error("expected a ready session");
		}
		harness.sources.set("folder/note.md", "鳥魚虫");

		expect(await harness.refreshSource()).toBe("refreshed");
		const after = harness.readyState();
		if (!after) {
			throw new Error("expected a ready session");
		}

		expect(after.snapshot).not.toBe(before.snapshot);
		expect(after.snapshot.text).toBe("鳥魚虫");
		expect(after.snapshot.contentHash).toBe("hash(鳥魚虫)");
		expect(after.bodySeed).not.toBe(before.bodySeed);
		expect(after.tokenSequences).not.toBe(before.tokenSequences);
		expect(after.pool).not.toBe(before.pool);
		expect(after.replacementCount).toBe(3);
		expect(after.freshness).toBe("fresh");
		expect(harness.bodyText()).toHaveLength(3);
	});

	it("returns to fresh even when the view was stale before refreshing", async () => {
		const harness = await openedHarness("猫犬");
		harness.sources.set("folder/note.md", "猫犬鳥");
		await harness.recheckSourceFreshness();
		expect(harness.readyState()?.freshness).toBe("stale");

		expect(await harness.refreshSource()).toBe("refreshed");
		expect(harness.readyState()?.freshness).toBe("fresh");
	});

	it("tokenizes each transformable text node exactly once", async () => {
		const harness = await openedHarness("猫犬");
		harness.sources.set("folder/note.md", "鳥魚");
		harness.tokenizeCalls = [];

		await harness.refreshSource();

		expect(harness.tokenizeCalls).toEqual(["鳥魚"]);
		expect(harness.controller.getSequenceCount()).toBe(1);
	});

	it("does not reuse the token sequences or pool captured before the refresh", async () => {
		const harness = await openedHarness("猫犬");
		const before = harness.readyState();
		harness.sources.set("folder/note.md", "鳥魚");

		await harness.refreshSource();
		const after = harness.readyState();

		expect(after?.tokenSequences).not.toBe(before?.tokenSequences);
		expect(after?.tokenSequences.flat().map((entry) => entry.surface)).toEqual([
			"鳥",
			"魚",
		]);
		expect(after?.pool).not.toBe(before?.pool);
	});
});

describe("Refresh source exclusivity", () => {
	it("refuses to reshuffle while a refresh is in flight", async () => {
		const harness = await openedHarness("猫犬");
		const gate = deferred<void>();
		harness.readGate = () => gate.promise;

		const refreshing = harness.refreshSource();
		expect(harness.busy.isBusy()).toBe(true);
		expect(await harness.reshuffle()).toBe("busy");

		gate.resolve();
		expect(await refreshing).toBe("refreshed");
		expect(harness.busy.isBusy()).toBe(false);
	});

	it("starts one run when the button is clicked repeatedly", async () => {
		const harness = await openedHarness("猫犬");
		const gate = deferred<void>();
		harness.readGate = () => gate.promise;
		harness.readCalls = [];

		const first = harness.refreshSource();
		const second = harness.refreshSource();
		const third = harness.refreshSource();

		expect(await second).toBe("busy");
		expect(await third).toBe("busy");
		gate.resolve();
		expect(await first).toBe("refreshed");
		expect(harness.readCalls).toEqual(["folder/note.md"]);
	});

	it("routes the button and the command through the same view method", async () => {
		const harness = await openedHarness("猫犬");
		const refreshSource = vi.fn(() => harness.refreshSource());
		const view = { refreshSource };

		// The button path calls the method directly.
		expect(await view.refreshSource()).toBe("refreshed");
		// The command path selects a view and calls the very same method.
		const invoked = invokeSemantropyViewCommand({
			activeView: view,
			existingViews: [],
			run: (target) => target.refreshSource(),
		});
		expect(invoked.status).toBe("ran");
		if (invoked.status !== "ran") {
			return;
		}
		expect(await invoked.outcome).toBe("refreshed");
		expect(refreshSource).toHaveBeenCalledTimes(2);
	});

	it("reports busy to the command while the button's run is still going", async () => {
		const harness = await openedHarness("猫犬");
		const gate = deferred<void>();
		harness.readGate = () => gate.promise;

		const fromButton = harness.refreshSource();
		const invoked = invokeSemantropyViewCommand({
			activeView: harness,
			existingViews: [],
			run: (target) => target.refreshSource(),
		});
		if (invoked.status !== "ran") {
			throw new Error("expected the command to run");
		}

		expect(await invoked.outcome).toBe("busy");
		gate.resolve();
		expect(await fromButton).toBe("refreshed");
	});
});

describe("Refresh source failures", () => {
	it("fails with one generalized message when the source cannot be read", async () => {
		const harness = await openedHarness("猫犬");
		harness.sources.delete("folder/note.md");

		expect(await harness.refreshSource()).toBe("failed");
		expect(harness.session.getState()).toEqual({
			status: "error",
			message: REFRESH_ERROR_MESSAGE,
		});
	});

	it("fails when rendering the refreshed body throws", async () => {
		const harness = await openedHarness("猫犬");
		harness.sources.set("folder/note.md", "鳥魚");
		harness.renderGate = () => Promise.reject(new Error("render blew up"));

		expect(await harness.refreshSource()).toBe("failed");
		expect(harness.session.getState()).toEqual({
			status: "error",
			message: REFRESH_ERROR_MESSAGE,
		});
	});

	it("fails when tokenizing the refreshed body throws", async () => {
		const harness = await openedHarness("猫犬");
		harness.sources.set("folder/note.md", "鳥魚");
		harness.tokenizeGate = () => Promise.reject(new Error("tokenizer down"));

		expect(await harness.refreshSource()).toBe("failed");
		expect(harness.session.getState()).toEqual({
			status: "error",
			message: REFRESH_ERROR_MESSAGE,
		});
	});

	it("keeps the note body, tokens and absolute paths out of messages and logs", async () => {
		const harness = await openedHarness("秘密本文", "/Users/someone/vault/note.md");
		harness.sources.delete("/Users/someone/vault/note.md");

		expect(await harness.refreshSource()).toBe("failed");
		const state = harness.session.getState();
		expect(state.status).toBe("error");
		if (state.status !== "error") {
			return;
		}
		expect(state.message).toBe(REFRESH_ERROR_MESSAGE);
		expect(state.message).not.toContain("秘密本文");
		expect(state.message).not.toContain("/Users/");
		const logged = JSON.stringify(harness.errorLogs);
		expect(logged).not.toContain("秘密本文");
		expect(logged).not.toContain("/Users/");
		expect(logged).toContain("failed to refresh the source note");
	});

	it("does not fall back to the previous analysis after a failure", async () => {
		const harness = await openedHarness("猫犬");
		harness.sources.delete("folder/note.md");

		await harness.refreshSource();

		expect(harness.readyState()).toBeNull();
		expect(harness.controller.getTextNodes()).toHaveLength(0);
	});
});

describe("Refresh source concurrency", () => {
	it("does not apply a refresh that a later Open superseded", async () => {
		const harness = await openedHarness("猫犬");
		const readGate = deferred<void>();
		harness.readGate = () => readGate.promise;
		harness.sources.set("folder/note.md", "古い本文");

		// Refresh A stalls on the read; Open B runs to completion meanwhile.
		const refreshing = harness.refreshSource();
		harness.readGate = null;
		harness.sources.set("folder/note.md", "新しい本文");
		await harness.open("folder/note.md", "note.md");

		readGate.resolve();
		expect(await refreshing).toBe("aborted");
		expect(harness.readyState()?.snapshot.text).toBe("新しい本文");
		expect(harness.bodyText()).toHaveLength("新しい本文".length);
	});

	it("does not apply a refresh that finished after the view closed", async () => {
		const harness = await openedHarness("猫犬");
		const gate = deferred<void>();
		harness.readGate = () => gate.promise;
		harness.sources.set("folder/note.md", "鳥魚");

		const refreshing = harness.refreshSource();
		harness.close();
		gate.resolve();

		expect(await refreshing).toBe("aborted");
		expect(harness.session.getState()).toEqual({ status: "empty" });
		expect(harness.controller.getTextNodes()).toHaveLength(0);
		expect(harness.controller.getContainer()).toBeNull();
	});

	it("stops a superseded refresh before it renders or tokenizes stale text", async () => {
		const harness = await openedHarness("猫犬");
		const readGate = deferred<void>();
		harness.readGate = () => readGate.promise;
		harness.sources.set("folder/note.md", "古い本文");

		const refreshing = harness.refreshSource();
		harness.readGate = null;
		harness.sources.set("folder/note.md", "新しい本文");
		await harness.open("folder/note.md", "note.md");
		harness.renderCalls = [];
		harness.tokenizeCalls = [];

		readGate.resolve();
		expect(await refreshing).toBe("aborted");
		// The superseded run does no further work at all: no wasted Markdown
		// render and no tokenize pass over a body nobody will see.
		expect(harness.renderCalls).toEqual([]);
		expect(harness.tokenizeCalls).toEqual([]);
	});

	it("does not apply tokens produced for a superseded request to newer text nodes", async () => {
		const harness = await openedHarness("猫犬");
		const reachedTokenize = deferred<void>();
		const releaseTokenize = deferred<void>();
		harness.tokenizeGate = () => {
			reachedTokenize.resolve();
			return releaseTokenize.promise;
		};
		harness.sources.set("folder/note.md", "古本");

		const refreshing = harness.refreshSource();
		await reachedTokenize.promise;

		// Refresh A is suspended inside tokenize; Open B rebuilds the body.
		harness.tokenizeGate = null;
		harness.sources.set("folder/note.md", "新本");
		await harness.open("folder/note.md", "note.md");
		const attached = harness.controller.getContainer();

		releaseTokenize.resolve();
		expect(await refreshing).toBe("aborted");
		expect(harness.controller.getContainer()).toBe(attached);
		expect(harness.readyState()?.snapshot.text).toBe("新本");
		expect(harness.bodyText()).toHaveLength(2);
	});

	it("does not apply a freshness verdict taken before the refresh", async () => {
		const harness = await openedHarness("猫犬");
		const checkGate = deferred<void>();
		harness.readGate = () => checkGate.promise;
		const checking = harness.recheckSourceFreshness();

		harness.readGate = null;
		harness.sources.set("folder/note.md", "鳥魚");
		expect(await harness.refreshSource()).toBe("refreshed");

		checkGate.resolve();
		expect(await checking).toEqual({
			status: "ignored",
			reason: "superseded",
		});
		expect(harness.readyState()?.freshness).toBe("fresh");
		expect(harness.readyState()?.snapshot.text).toBe("鳥魚");
	});
});

describe("Reshuffle while stale", () => {
	it("reshuffles the stored analysis without re-reading or tokenizing", async () => {
		const harness = await openedHarness("猫犬");
		harness.sources.set("folder/note.md", "鳥魚虫");
		await harness.recheckSourceFreshness();
		const before = harness.readyState();
		if (!before) {
			throw new Error("expected a ready session");
		}
		expect(before.freshness).toBe("stale");

		harness.tokenizeCalls = [];
		harness.readCalls = [];
		expect(await harness.reshuffle()).toBe("applied");
		const after = harness.readyState();
		if (!after) {
			throw new Error("expected a ready session");
		}

		expect(harness.tokenizeCalls).toEqual([]);
		expect(harness.readCalls).toEqual([]);
		expect(after.freshness).toBe("stale");
		expect(after.snapshot).toBe(before.snapshot);
		expect(after.tokenSequences).toBe(before.tokenSequences);
		expect(after.pool).toBe(before.pool);
		expect(after.bodySeed).not.toBe(before.bodySeed);
	});
});

describe("Refresh after the view lifecycle restarts", () => {
	it("works again after close then open", async () => {
		const harness = await openedHarness("猫犬");
		harness.close();
		expect(await harness.refreshSource()).toBe("aborted");

		harness.reopen();
		await harness.open("folder/note.md", "note.md");
		harness.sources.set("folder/note.md", "鳥魚");

		expect(await harness.refreshSource()).toBe("refreshed");
		expect(harness.readyState()?.snapshot.text).toBe("鳥魚");

		// Freshness detection is live again too.
		harness.sources.set("folder/note.md", "鳥魚虫");
		expect(await harness.recheckSourceFreshness()).toEqual({
			status: "applied",
			freshness: "stale",
		});
	});
});

describe("Source note read-only boundary", () => {
	it("leaves the saved note and the editor buffer byte-identical", async () => {
		const harness = await openedHarness("猫犬");
		harness.sources.set("folder/note.md", "保存本文");
		harness.editors.set("folder/note.md", "未保存本文");
		const before = harness.storedBodies();

		await harness.refreshSource();
		await harness.recheckSourceFreshness();
		await harness.reshuffle();
		harness.markLost();
		await harness.recheckSourceFreshness("編集中の本文");

		expect(harness.storedBodies()).toBe(before);
	});

	it("keeps Obsidian objects and callbacks out of the session state", async () => {
		const harness = await openedHarness("猫犬");
		await harness.refreshSource();
		const encoded = JSON.stringify(harness.session.getState());

		expect(encoded).not.toMatch(/TFile|MarkdownView|Vault|Editor|HTMLElement/);
		expect(harness.session.getState()).not.toHaveProperty("vault");
		expect(harness.session.getState()).not.toHaveProperty("readCurrentText");
		expect(new SemantropySession().getState()).toEqual({ status: "empty" });
	});
});

describe("Source events arriving while a request is in flight", () => {
	it("still routes events to a view whose session is loading", async () => {
		const harness = await openedHarness("猫犬");
		const gate = deferred<void>();
		harness.readGate = () => gate.promise;

		const refreshing = harness.refreshSource();
		// The session is loading, so the ready snapshot is gone; the view must
		// still answer with the path it is working on.
		expect(harness.session.getState().status).toBe("loading");
		expect(harness.session.getReadySnapshot()).toBeNull();
		expect(harness.getSourcePath()).toBe("folder/note.md");

		const delivered = dispatchSourceEvent({
			event: {
				kind: "changed",
				sourcePath: "folder/note.md",
				editorText: "編集後",
			},
			views: [harness],
			getSourcePath: (view) => view.getSourcePath(),
			recheck: (view, text) => {
				void view.recheckSourceFreshness(text);
			},
			markLost: (view) => {
				view.markLost();
			},
		});
		expect(delivered).toEqual([harness]);

		gate.resolve();
		await refreshing;
	});

	it("does not publish a refresh as fresh when the note changed mid-request", async () => {
		const harness = await openedHarness("猫犬");
		const reachedTokenize = deferred<void>();
		const releaseTokenize = deferred<void>();
		harness.tokenizeGate = () => {
			reachedTokenize.resolve();
			return releaseTokenize.promise;
		};
		harness.sources.set("folder/note.md", "T1");

		// Refresh reads T1 and stalls inside tokenize.
		const refreshing = harness.refreshSource();
		await reachedTokenize.promise;

		// The user edits to T2 while the refresh is still analysing T1.
		harness.editors.set("folder/note.md", "T2");
		void harness.recheckSourceFreshness("T2");

		harness.tokenizeGate = null;
		releaseTokenize.resolve();
		expect(await refreshing).toBe("refreshed");

		const state = harness.readyState();
		expect(state?.snapshot.text).toBe("T1");
		// The refreshed body is the one the user asked for, but the note has
		// already moved past it, so it must not claim to be current.
		expect(state?.freshness).toBe("stale");
	});

	it("does not publish an open as fresh when the note changed mid-request", async () => {
		const harness = new RefreshHarness();
		harness.sources.set("folder/note.md", "T1");
		const reachedTokenize = deferred<void>();
		const releaseTokenize = deferred<void>();
		harness.tokenizeGate = () => {
			reachedTokenize.resolve();
			return releaseTokenize.promise;
		};

		const opening = harness.open("folder/note.md", "note.md");
		await reachedTokenize.promise;
		harness.editors.set("folder/note.md", "T2");
		void harness.recheckSourceFreshness("T2");

		harness.tokenizeGate = null;
		releaseTokenize.resolve();
		await opening;

		expect(harness.readyState()?.snapshot.text).toBe("T1");
		expect(harness.readyState()?.freshness).toBe("stale");
	});

	it("recovers to fresh on the next check when the body really did match", async () => {
		const harness = await openedHarness("猫犬");
		const reachedTokenize = deferred<void>();
		const releaseTokenize = deferred<void>();
		harness.tokenizeGate = () => {
			reachedTokenize.resolve();
			return releaseTokenize.promise;
		};
		harness.sources.set("folder/note.md", "鳥魚");

		const refreshing = harness.refreshSource();
		await reachedTokenize.promise;
		// A save event lands mid-request even though the bytes are unchanged.
		void harness.recheckSourceFreshness();
		harness.tokenizeGate = null;
		releaseTokenize.resolve();
		await refreshing;

		// Conservatively stale, but not a dead end: the next check clears it.
		expect(harness.readyState()?.freshness).toBe("stale");
		expect(await harness.recheckSourceFreshness()).toEqual({
			status: "applied",
			freshness: "fresh",
		});
	});

	it("keeps a refresh fresh when no event arrived during it", async () => {
		const harness = await openedHarness("猫犬");
		harness.sources.set("folder/note.md", "鳥魚");

		expect(await harness.refreshSource()).toBe("refreshed");
		expect(harness.readyState()?.freshness).toBe("fresh");
	});

	it("marks a rename or delete during a refresh stale rather than fresh", async () => {
		const harness = await openedHarness("猫犬");
		const reachedTokenize = deferred<void>();
		const releaseTokenize = deferred<void>();
		harness.tokenizeGate = () => {
			reachedTokenize.resolve();
			return releaseTokenize.promise;
		};
		harness.sources.set("folder/note.md", "鳥魚");

		const refreshing = harness.refreshSource();
		await reachedTokenize.promise;
		dispatchSourceEvent({
			event: { kind: "lost", sourcePath: "folder/note.md" },
			views: [harness],
			getSourcePath: (view) => view.getSourcePath(),
			recheck: (view, text) => {
				void view.recheckSourceFreshness(text);
			},
			markLost: (view) => {
				view.markLost();
			},
		});

		harness.tokenizeGate = null;
		releaseTokenize.resolve();
		expect(await refreshing).toBe("refreshed");
		expect(harness.readyState()?.freshness).toBe("stale");
		expect(harness.readyState()?.snapshot.sourcePath).toBe("folder/note.md");
	});

	it("stops routing events to the view once it is closed", async () => {
		const harness = await openedHarness("猫犬");
		harness.close();

		expect(harness.getSourcePath()).toBeNull();
		expect(
			dispatchSourceEvent({
				event: {
					kind: "changed",
					sourcePath: "folder/note.md",
					editorText: "編集後",
				},
				views: [harness],
				getSourcePath: (view) => view.getSourcePath(),
				recheck: (view, text) => {
					void view.recheckSourceFreshness(text);
				},
				markLost: (view) => {
					view.markLost();
				},
			}),
		).toEqual([]);
	});
});

describe("Busy ownership across superseding operations", () => {
	it("does not leave a superseded Refresh's claim on a completed Open", async () => {
		const harness = await openedHarness("猫犬");
		const gate = deferred<void>();
		harness.readGate = () => gate.promise;

		// Refresh A stalls; Open B takes the view over and finishes.
		const refreshing = harness.refreshSource();
		expect(harness.busy.isBusy()).toBe(true);
		harness.readGate = null;
		harness.sources.set("folder/note.md", "鳥魚");
		await harness.open("folder/note.md", "note.md");

		// B is ready, so both actions must be usable even though A is unsettled.
		expect(harness.busy.isBusy()).toBe(false);
		expect(harness.readyState()?.replacementCount).toBeGreaterThan(0);
		expect(await harness.reshuffle()).toBe("applied");

		gate.resolve();
		expect(await refreshing).toBe("aborted");
	});

	it("keeps Refresh usable after an Open superseded a stalled Refresh", async () => {
		const harness = await openedHarness("猫犬");
		const gate = deferred<void>();
		harness.readGate = () => gate.promise;

		const stalled = harness.refreshSource();
		harness.readGate = null;
		await harness.open("folder/note.md", "note.md");

		harness.sources.set("folder/note.md", "鳥魚");
		expect(await harness.refreshSource()).toBe("refreshed");
		expect(harness.readyState()?.snapshot.text).toBe("鳥魚");

		gate.resolve();
		expect(await stalled).toBe("aborted");
	});

	it("does not let a superseded Refresh release a newer Refresh's claim", async () => {
		const harness = await openedHarness("猫犬");
		const stalledGate = deferred<void>();
		harness.readGate = () => stalledGate.promise;

		const stalled = harness.refreshSource();
		harness.readGate = null;
		await harness.open("folder/note.md", "note.md");

		// A second Refresh claims the gate while the first is still unsettled.
		const secondGate = deferred<void>();
		harness.readGate = () => secondGate.promise;
		const second = harness.refreshSource();
		expect(harness.busy.isBusy()).toBe(true);

		stalledGate.resolve();
		expect(await stalled).toBe("aborted");
		// The stale run's finally must not have freed the second run's claim.
		expect(harness.busy.isBusy()).toBe(true);
		expect(await harness.reshuffle()).toBe("busy");

		secondGate.resolve();
		expect(await second).toBe("refreshed");
		expect(harness.busy.isBusy()).toBe(false);
	});

	it("frees the actions after close then reopen", async () => {
		const harness = await openedHarness("猫犬");
		const gate = deferred<void>();
		harness.readGate = () => gate.promise;

		const stalled = harness.refreshSource();
		harness.close();
		expect(harness.busy.isBusy()).toBe(false);

		harness.reopen();
		harness.readGate = null;
		await harness.open("folder/note.md", "note.md");
		expect(harness.busy.isBusy()).toBe(false);
		expect(await harness.reshuffle()).toBe("applied");

		gate.resolve();
		expect(await stalled).toBe("aborted");
	});
});

describe("Changes between capturing the body and watching the note", () => {
	it("does not publish an open as fresh when the note changed while the leaf was revealed", async () => {
		const harness = new RefreshHarness();
		harness.editors.set("folder/note.md", "T1");
		harness.sources.set("folder/note.md", "T1");

		const revealed = deferred<void>();
		// 1. T1 is captured synchronously, 2. revealing the leaf is pending.
		const opening = harness.openLikePlugin(
			"folder/note.md",
			"note.md",
			() => revealed.promise,
		);

		// 3. The note becomes T2 while no view is watching it yet.
		harness.editors.set("folder/note.md", "T2");
		expect(
			harness.notifySourceEvent("folder/note.md", {
				kind: "changed",
				editorText: "T2",
			}),
		).toEqual([]);

		// 4. The leaf appears and the captured T1 is opened.
		revealed.resolve();
		await opening;

		// 5. The snapshot is the captured T1, so it must not claim to be fresh.
		expect(harness.readyState()?.snapshot.text).toBe("T1");
		expect(harness.readyState()?.freshness).toBe("stale");
	});

	it("treats a rename or delete during that window as stale too", async () => {
		const harness = new RefreshHarness();
		harness.editors.set("folder/note.md", "T1");
		harness.sources.set("folder/note.md", "T1");

		const revealed = deferred<void>();
		const opening = harness.openLikePlugin(
			"folder/note.md",
			"note.md",
			() => revealed.promise,
		);
		harness.notifySourceEvent("folder/note.md", { kind: "lost" });
		revealed.resolve();
		await opening;

		expect(harness.readyState()?.freshness).toBe("stale");
		expect(harness.readyState()?.snapshot.sourcePath).toBe("folder/note.md");
	});

	it("stays fresh when the note did not change during the window", async () => {
		const harness = new RefreshHarness();
		harness.editors.set("folder/note.md", "T1");
		harness.sources.set("folder/note.md", "T1");

		const revealed = deferred<void>();
		const opening = harness.openLikePlugin(
			"folder/note.md",
			"note.md",
			() => revealed.promise,
		);
		revealed.resolve();
		await opening;

		expect(harness.readyState()?.snapshot.text).toBe("T1");
		expect(harness.readyState()?.freshness).toBe("fresh");
	});

	it("ignores a change to another note during the window", async () => {
		const harness = new RefreshHarness();
		harness.editors.set("folder/note.md", "T1");
		harness.sources.set("folder/note.md", "T1");
		harness.sources.set("other.md", "別本文");

		const revealed = deferred<void>();
		const opening = harness.openLikePlugin(
			"folder/note.md",
			"note.md",
			() => revealed.promise,
		);
		harness.notifySourceEvent("other.md", {
			kind: "changed",
			editorText: "別の編集",
		});
		revealed.resolve();
		await opening;

		expect(harness.readyState()?.freshness).toBe("fresh");
	});

	it("records the revision even when no view is listening yet", () => {
		const harness = new RefreshHarness();
		const token = harness.revisions.current("folder/note.md");

		expect(
			harness.notifySourceEvent("folder/note.md", {
				kind: "changed",
				editorText: "T2",
			}),
		).toEqual([]);
		expect(harness.revisions.changedSince("folder/note.md", token)).toBe(true);
	});

	it("recovers to fresh on the next check after a capture-window change", async () => {
		const harness = new RefreshHarness();
		harness.editors.set("folder/note.md", "T1");
		harness.sources.set("folder/note.md", "T1");

		const revealed = deferred<void>();
		const opening = harness.openLikePlugin(
			"folder/note.md",
			"note.md",
			() => revealed.promise,
		);
		// A save with no edits still bumps the revision.
		harness.notifySourceEvent("folder/note.md", {
			kind: "changed",
			editorText: null,
		});
		revealed.resolve();
		await opening;
		expect(harness.readyState()?.freshness).toBe("stale");

		expect(await harness.recheckSourceFreshness()).toEqual({
			status: "applied",
			freshness: "fresh",
		});
	});
});
