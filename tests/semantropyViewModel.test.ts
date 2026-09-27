import { describe, expect, it } from "vitest";
import { token } from "./tokenFixtures";
import { SemantropySession } from "../src/application/SemantropySession";
import { createSourceSnapshot } from "../src/application/SourceSnapshot";
import { STALE_SOURCE_MESSAGE } from "../src/application/sourceFreshness";
import { toSemantropyViewModel } from "../src/view/semantropyViewModel";
import { emptyReadyAnalysis } from "./readyAnalysis";
import type { SemantropyReadyAnalysis } from "../src/application/SemantropySession";

function readySession(
	text: string,
	bodySeed: number,
	replacementCount = 0,
	overrides: Partial<SemantropyReadyAnalysis> = {},
): SemantropySession {
	const session = new SemantropySession();
	const requestId = session.beginLoading();
	session.completeReady(
		requestId,
		createSourceSnapshot({
			sourcePath: "folder/小説断片.md",
			sourceName: "小説断片.md",
			text,
			contentHash: "hash",
		}),
		bodySeed,
		emptyReadyAnalysis({
			replacementCount,
			// Unless a test says otherwise, a note that exchanged N slots had at
			// least N slots it could exchange.
			replaceableSlotCount: replacementCount,
			...overrides,
		}),
	);
	return session;
}

describe("toSemantropyViewModel", () => {
	it("shows an analyzing message while loading", () => {
		const session = new SemantropySession();
		session.beginLoading();
		const model = toSemantropyViewModel(session.getState());
		expect(model.message).toBe("Analyzing…");
		expect(model).not.toHaveProperty("seedLabel");
		expect(JSON.stringify(model)).not.toMatch(/seed:/i);
	});

	it("displays replacement count 0 without treating it as missing", () => {
		// An analyzed note (one run) with nothing to exchange it with.
		const model = toSemantropyViewModel(
			readySession("本文", 0, 0, { tokenSequences: [[token({ surface: "本文" })]] }).getState(),
		);
		expect(model).not.toHaveProperty("seedLabel");
		expect(JSON.stringify(model)).not.toMatch(/seed:/i);
		expect(model.replacementLabel).toBe("replacements: 0");
		expect(model.sourceLabel).toBe("Target: 小説断片.md");
		expect(model.bodyText).toBeNull();
		expect(model.message).toBe(
			"Not enough replaceable nouns in this note.",
		);
		expect(model.showReshuffle).toBe(true);
		expect(model.reshuffleEnabled).toBe(false);
	});

	it("enables reshuffle only when replacements exist and the view is not busy", () => {
		const enabled = toSemantropyViewModel(readySession("本文", 1, 4).getState());
		expect(enabled.replacementLabel).toBe("replacements: 4");
		expect(enabled.reshuffleEnabled).toBe(true);
		expect(enabled.message).toBeNull();
		const busy = toSemantropyViewModel(readySession("本文", 1, 4).getState(), {
			busy: true,
		});
		expect(busy.reshuffleEnabled).toBe(false);
		expect(busy.showReshuffle).toBe(true);
	});

	it("does not put raw markdown into the chrome body", () => {
		const raw = '<script>alert("xss")</script><b>bold</b>';
		const model = toSemantropyViewModel(readySession(raw, 1).getState());
		expect(model.bodyText).toBeNull();
		expect(model.bodyAsTextContent).toBe(true);
	});

	it("does not hide reshuffle in empty or loading states as enabled", () => {
		const empty = toSemantropyViewModel({ status: "empty" });
		expect(empty.showReshuffle).toBe(false);
		expect(empty.reshuffleEnabled).toBe(false);
		const session = new SemantropySession();
		session.beginLoading();
		const loading = toSemantropyViewModel(session.getState());
		expect(loading.showReshuffle).toBe(false);
		expect(loading.reshuffleEnabled).toBe(false);
	});

	it("does not keep a body in empty or error states", () => {
		const session = readySession("stale body", 1);
		const emptyId = session.beginLoading();
		session.completeEmpty(emptyId);
		expect(toSemantropyViewModel(session.getState()).bodyText).toBeNull();

		const errorId = session.beginLoading();
		session.completeError(
			errorId,
			"Could not open the note. Run Semantropy: Open again.",
		);
		const errorModel = toSemantropyViewModel(session.getState());
		expect(errorModel.bodyText).toBeNull();
		expect(errorModel.message).not.toContain("stale body");
		expect(errorModel.showReshuffle).toBe(false);
		expect(errorModel).not.toHaveProperty("seedLabel");
		expect(JSON.stringify(errorModel)).not.toMatch(/seed:/i);
	});

	it("offers Refresh target alongside Reshuffle when a source is ready", () => {
		const model = toSemantropyViewModel(readySession("本文", 3, 2).getState());
		expect(model.showRefresh).toBe(true);
		expect(model.refreshEnabled).toBe(true);
		expect(model.showCopy).toBe(true);
		expect(model.copyEnabled).toBe(true);
		expect(model.showCollect).toBe(true);
		expect(model.collectEnabled).toBe(true);
		expect(model.sourceLabel).toBe("Target: 小説断片.md");
		expect(model).not.toHaveProperty("seedLabel");
		expect(JSON.stringify(model)).not.toMatch(/seed:/i);
		expect(model.replacementLabel).toBe("replacements: 2");
	});

	it("offers Refresh target even when nothing can be reshuffled", () => {
		const model = toSemantropyViewModel(readySession("本文", 3, 0).getState());
		expect(model.showRefresh).toBe(true);
		expect(model.refreshEnabled).toBe(true);
		expect(model.showCopy).toBe(true);
		expect(model.copyEnabled).toBe(true);
		expect(model.showCollect).toBe(true);
		expect(model.collectEnabled).toBe(true);
		expect(model.reshuffleEnabled).toBe(false);
	});

	it("disables every action while the view is busy", () => {
		const model = toSemantropyViewModel(readySession("本文", 3, 2).getState(), {
			busy: true,
		});
		expect(model.reshuffleEnabled).toBe(false);
		expect(model.refreshEnabled).toBe(false);
		expect(model.copyEnabled).toBe(false);
		expect(model.collectEnabled).toBe(false);
		expect(model.levelControlEnabled).toBe(false);
		expect(model.showCopy).toBe(true);
		expect(model.showCollect).toBe(true);
	});

	it("hides both actions while loading", () => {
		const session = new SemantropySession();
		session.beginLoading();
		const model = toSemantropyViewModel(session.getState());
		expect(model.showReshuffle).toBe(false);
		expect(model.showRefresh).toBe(false);
		expect(model.showCopy).toBe(false);
		expect(model.showCollect).toBe(false);
		expect(model.refreshEnabled).toBe(false);
	});

	it("reports fresh with no stale message", () => {
		const model = toSemantropyViewModel(readySession("本文", 3, 2).getState());
		expect(model.freshness).toBe("fresh");
		expect(model.staleMessage).toBeNull();
	});

	it("states staleness in words while keeping counts and reshuffle", () => {
		const session = readySession("本文", 3, 2);
		session.markSourceStale();
		const model = toSemantropyViewModel(session.getState());

		expect(model.freshness).toBe("stale");
		expect(model.staleMessage).toBe(STALE_SOURCE_MESSAGE);
		expect(model.staleMessage).toContain("Refresh target");
		expect(model).not.toHaveProperty("seedLabel");
		expect(JSON.stringify(model)).not.toMatch(/seed:/i);
		expect(model.replacementLabel).toBe("replacements: 2");
		// Stale is not an error: the body stays and Reshuffle stays available.
		expect(model.reshuffleEnabled).toBe(true);
		expect(model.showRefresh).toBe(true);
		expect(model.showCopy).toBe(true);
		expect(model.copyEnabled).toBe(true);
		expect(model.showCollect).toBe(true);
		expect(model.collectEnabled).toBe(true);
	});

	it("keeps the note body out of the stale message", () => {
		const session = readySession("秘密の本文", 3, 2);
		session.markSourceStale();
		const model = toSemantropyViewModel(session.getState());
		expect(model.staleMessage).not.toContain("秘密の本文");
		expect(model.bodyText).toBeNull();
	});

	it("shows no stale message outside a ready session", () => {
		expect(toSemantropyViewModel({ status: "empty" }).staleMessage).toBeNull();
		expect(toSemantropyViewModel({ status: "empty" }).freshness).toBeNull();
		expect(
			toSemantropyViewModel({ status: "error", message: "boom" }).staleMessage,
		).toBeNull();
	});
});
