import { describe, expect, it } from "vitest";
import { bodyFragmentFromReadySession } from "../src/application/bodyFragmentFromReady";
import { SemantropySession } from "../src/application/SemantropySession";
import { createSourceSnapshot } from "../src/application/SourceSnapshot";
import { SEMANTROPY_ALGORITHM_VERSION } from "../src/random/seededRandom";
import { assertBodySemantropy } from "../src/settings/bodySemantropy";
import { emptyReadyAnalysis } from "./readyAnalysis";
import { collectPath, collectVocabulary, COLLECT_FIXTURE_FINGERPRINT } from "./collectFixtures";
import { MANUAL_ALGORITHM_VERSION } from "../src/analysis/manualDisplay";

const HASH = "ab".repeat(32);
const NOTE_BODY = "太郎は駅で花子を待っていた。";
const SELECTED = "  おかき的な自殺\n ";
const VOCABULARY = collectVocabulary(["folder/桜桃.md", "other.md"], {
	sources: [collectPath("folder/桜桃.md", HASH), collectPath("other.md", HASH)],
	fingerprint: COLLECT_FIXTURE_FINGERPRINT,
	drawMode: "frequency",
});

function readyState(options: {
	bodySeed: number;
	bodySemantropy?: number;
	freshness?: "fresh" | "stale";
}) {
	const session = new SemantropySession();
	const requestId = session.beginLoading();
	session.completeReady(
		requestId,
		createSourceSnapshot({
			sourcePath: "folder/桜桃.md",
			sourceName: "桜桃.md",
			text: NOTE_BODY,
			contentHash: HASH,
		}),
		options.bodySeed,
		emptyReadyAnalysis({
			bodySemantropy: assertBodySemantropy(options.bodySemantropy ?? 50),
			algorithmVersion: SEMANTROPY_ALGORITHM_VERSION,
		}),
	);
	if (options.freshness === "stale") {
		session.markSourceStale();
	}
	const state = session.getState();
	if (state.status !== "ready") {
		throw new Error("expected a ready session");
	}
	return state;
}

describe("bodyFragmentFromReadySession", () => {
	it("builds a body input from the ready snapshot and the captured text", () => {
		const state = readyState({ bodySeed: 1170956989, bodySemantropy: 50 });
		const input = bodyFragmentFromReadySession(state, SELECTED, {
			vocabulary: VOCABULARY,
		});
		expect(input).toEqual({
			type: "body",
			text: SELECTED,
			target: { path: "folder/桜桃.md", contentHash: HASH },
			vocabulary: VOCABULARY,
			bodySemantropy: 50,
			algorithmVersion: SEMANTROPY_ALGORITHM_VERSION,
			hasManualEdits: false,
		});
		expect(input).not.toHaveProperty("bodySeed");
		expect(input).not.toHaveProperty("seed");
		expect(input).not.toHaveProperty("sourceName");
		expect(input).not.toHaveProperty("freshness");
		expect(input).not.toHaveProperty("tokenSequences");
		expect(input).not.toHaveProperty("pool");
		expect(input).not.toHaveProperty("manualAlgorithmVersion");
		expect(JSON.stringify(input)).not.toContain(NOTE_BODY);
		expect(JSON.stringify(input)).not.toContain("/Users/");
	});

	it("does not copy internal generation state even when it is 0", () => {
		const input = bodyFragmentFromReadySession(
			readyState({ bodySeed: 0 }),
			"断片",
			{ vocabulary: VOCABULARY },
		);
		expect(input).not.toHaveProperty("bodySeed");
		expect(input).not.toHaveProperty("seed");
		expect(JSON.stringify(input)).not.toMatch(/"seed"|"bodySeed"/);
	});

	it("uses the displayed snapshot even when the view is stale", () => {
		const state = readyState({
			bodySeed: 9,
			bodySemantropy: 75,
			freshness: "stale",
		});
		expect(state.freshness).toBe("stale");
		const input = bodyFragmentFromReadySession(state, "断片", {
			vocabulary: VOCABULARY,
		});
		expect(input.target.path).toBe("folder/桜桃.md");
		expect(input.target.contentHash).toBe(HASH);
		expect(input.vocabulary).toEqual(VOCABULARY);
		expect(input.vocabulary.drawMode).toBe("frequency");
		expect(input).not.toHaveProperty("bodySeed");
		expect(input.bodySemantropy).toBe(75);
		expect(input).not.toHaveProperty("freshness");
	});

	it("records only overlapping Manual overrides", () => {
		const input = bodyFragmentFromReadySession(
			readyState({ bodySeed: 1 }),
			"断片",
			{
				vocabulary: VOCABULARY,
				manualOverrides: [
					{ tokenId: "keep", kind: "replacement", localRevision: 2 },
					{ tokenId: "restore", kind: "restore-original", localRevision: 0 },
				],
			},
		);
		expect(input.hasManualEdits).toBe(true);
		if (!input.hasManualEdits) {
			throw new Error("expected manual");
		}
		expect(input.manualAlgorithmVersion).toBe(MANUAL_ALGORITHM_VERSION);
		expect(input.manualOverrides).toEqual([
			{ tokenId: "keep", kind: "replacement", localRevision: 2 },
			{ tokenId: "restore", kind: "restore-original", localRevision: 0 },
		]);
		expect(JSON.stringify(input)).not.toMatch(
			/"candidateId"|"displayFormId"|"connectionKey"|"rubyVariantId"/,
		);
	});
});
